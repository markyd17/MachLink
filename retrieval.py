"""
Answers questions using ONLY the loaded aircraft JSON data - simple keyword
matching against qa_snippets, systems_notes, weapons, and checklist steps.
No LLM involved here, so nothing gets invented.

If nothing matches and an Anthropic API key is configured, app.py can fall
back to ask_llm_fallback() - but that path is always clearly labeled to the
user as an AI-generated answer rather than sourced content.
"""
import re

# Words that carry no real search meaning on their own - without filtering
# these out, a hint phrase like "how do I start the apu" also matches almost
# any other question ("how do I ...the..." shows up in nearly every natural
# question), because a single shared word is enough to count as a match.
# Deliberately does NOT include aviation words that are meaningful on their
# own even though they're short/common in everyday English, e.g. "on",
# "off", "up", "down" (switch/gear states) or "arm"/"safe".
_STOPWORDS = {
    "a", "an", "the", "i", "me", "my", "you", "your", "it", "its", "this",
    "that", "these", "those", "is", "are", "was", "were", "be", "been",
    "being", "do", "does", "did", "done", "how", "what", "when", "where",
    "why", "which", "who", "whom", "can", "could", "would", "should",
    "will", "shall", "may", "might", "must", "to", "of", "in", "at", "for",
    "and", "or", "but", "so", "with", "from", "by", "as", "please",
    "thanks", "thank", "tell", "show", "give", "need", "want", "there",
    "here", "if", "then", "than", "just", "also", "about", "into",
}


def _tokenize(s):
    # Split letter-runs and digit-runs separately even when they're jammed
    # together with no punctuation between them (e.g. "MK-82AIR" -> "mk",
    # "82", "air" - not one "82air" blob) - this is what makes "mk82" (no
    # dash) tokenize the same as "mk-82" (both -> "mk"+"82"), and what gives
    # "MK-82AIR" a standalone "82" token so it scores the same as "MK-82"
    # for a query mentioning "82", instead of losing to it on a technicality.
    words = re.findall(r"[a-z]+|[0-9]+", s.lower())
    return {w for w in words if w not in _STOPWORDS}


def search_aircraft_data(aircraft_data, query):
    """Returns a list of matches with their source, ranked by keyword overlap."""
    if not aircraft_data:
        return []

    q_tokens = _tokenize(query)
    if not q_tokens:
        return []

    results = []

    for snip in aircraft_data.get("qa_snippets", []):
        hint_tokens = set()
        for h in snip.get("question_hints", []):
            hint_tokens |= _tokenize(h)
        overlap = len(q_tokens & hint_tokens)
        if overlap > 0:
            results.append({
                "type": "qa_snippet",
                "score": overlap,
                "answer": snip["answer"],
                "matched_on": list(q_tokens & hint_tokens),
            })

    for note in aircraft_data.get("systems_notes", []):
        topic_tokens = _tokenize(note.get("topic", ""))
        overlap = len(q_tokens & topic_tokens)
        if overlap > 0:
            results.append({
                "type": "systems_note",
                "score": overlap,
                "topic": note["topic"],
                "answer": f"{note['topic']}: {note['notes']}",
                "matched_on": list(q_tokens & topic_tokens),
            })

    for weapon in aircraft_data.get("weapons", []):
        name_tokens = _tokenize(weapon.get("name", ""))
        overlap = len(q_tokens & name_tokens)
        if overlap > 0:
            # Return the real switchology array as-is (each entry is either a
            # plain string, or {"text": ..., "binding_key": ...} where a real
            # physical-button annotation has been curated) rather than
            # flattening it into one paragraph - lets the UI render it as an
            # actual checklist, in the guide's own order, with real button
            # labels resolved where we have them instead of just whatever
            # DCS's stock default keybind the guide happens to mention.
            results.append({
                "type": "weapon",
                "score": overlap,
                "name": weapon["name"],
                "employment_notes": weapon.get("employment_notes", ""),
                "steps": weapon.get("switchology", []),
                "matched_on": list(q_tokens & name_tokens),
            })

    for jett in aircraft_data.get("ordnance_jettison", []):
        name_tokens = _tokenize(jett.get("name", "")) | _tokenize("jettison drop stores dump ordnance")
        overlap = len(q_tokens & name_tokens)
        if overlap > 0:
            results.append({
                "type": "ordnance_jettison",
                "score": overlap,
                "name": jett["name"],
                "employment_notes": jett.get("notes", ""),
                "steps": jett.get("steps", []),
                "matched_on": list(q_tokens & name_tokens),
            })

    if not results:
        return []

    # Only keep the best-scoring tier, not every match with any overlap at
    # all - a lone shared word that happens to be common across several
    # unrelated entries (e.g. "fire" showing up in both a gun snippet and a
    # missile snippet) would otherwise ride along next to a clearly better
    # match instead of being dropped.
    top_score = max(r["score"] for r in results)
    results = [r for r in results if r["score"] == top_score]
    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:5]


def ask_llm_fallback(query, aircraft_context, api_key, model):
    """
    Optional fallback for questions the loaded data doesn't cover. Explicitly
    NOT used unless the user has configured an API key, and every caller must
    label the result as AI-generated, not sourced.
    """
    if not api_key:
        return {"error": "No Anthropic API key configured - fallback disabled."}

    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    system = (
        "You are a flight-sim assistant. The user is asking about an aircraft "
        "in DCS or MSFS. You were NOT given verified checklist data for this "
        "question, so answer only with general, well-known simulation "
        "knowledge, be explicit about any uncertainty, and recommend the user "
        "verify against their official checklist/guide before relying on it "
        "for anything safety- or procedure-critical."
    )
    user_msg = f"Aircraft context: {aircraft_context}\n\nQuestion: {query}"
    resp = client.messages.create(
        model=model,
        max_tokens=600,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )
    text = "".join(block.text for block in resp.content if block.type == "text")
    return {"answer": text, "source": "ai_fallback_unverified"}
