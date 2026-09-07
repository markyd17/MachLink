"""
Joystick Diagrams Output Plugin for MachLink.

THIS FILE DOES NOT RUN INSIDE MACHLINK. It runs inside the separate
Joystick Diagrams app (github.com/Rexeh/joystick-diagrams), which already
knows how to read DCS's real control-binding files and match them against
your exact hardware's built-in templates (WinCtrl/WinWing Orion 2, MFDs,
etc). This plugin just gets called after each export and writes that
already-parsed binding data out as JSON, into a folder MachLink reads
from - so MachLink never has to parse DCS's .diff.lua files or build
its own button-label database.

Install: this whole `machlink_export` folder gets copied into
Joystick Diagrams' output_plugins directory:
    %APPDATA%\\Roaming\\Joystick Diagrams\\output_plugins\\machlink_export\\
(MachLink's own copy here, under integrations/, is the source of
truth - re-copy it there any time this file changes.)

After installing, open Joystick Diagrams > Settings > Output Plugins,
enable "MachLink Export", and confirm/set its output folder setting
(defaults to this project's data/bindings_live folder). Then run a normal
export from the Export page - one JSON file gets written per device per
aircraft profile.
"""
import json
import logging
from pathlib import Path

from pydantic import Field

from joystick_diagrams.plugins.output_plugin_interface import ExportResult, OutputPluginInterface
from joystick_diagrams.plugins.plugin_settings import PluginMeta, PluginSettings

_logger = logging.getLogger(__name__)

# Personal, single-machine default - this plugin is only ever installed on
# this PC for this one project, so a hardcoded default (still user-editable
# in the Output Plugins settings screen, since it's a real plugin setting,
# not baked-in) is simpler than trying to make the path portable.
_DEFAULT_OUTPUT_DIR = "C:/MachLink/data/bindings_live"


class MachLinkExportSettings(PluginSettings):
    output_dir: Path | None = Field(
        default=None,
        title="MachLink bindings_live folder",
        json_schema_extra={
            "is_folder": True,
            "default_path": _DEFAULT_OUTPUT_DIR,
            "required": True,
        },
    )


def _identifier_of(input_obj, fallback_key):
    """The physical button/axis id, e.g. 'BUTTON_3' - falls back to the
    dict key Joystick Diagrams itself used if the object doesn't expose its
    own .identifier for some reason (defensive, not expected to trigger)."""
    return getattr(input_obj, "identifier", None) or fallback_key


def _command_of(input_obj):
    return getattr(input_obj, "command", None)


def _modifiers_of(input_obj):
    # Modifier objects aren't a simple flat structure (see the spec's
    # "Multi-device or modifier-key bindings" note) - stringify defensively
    # for this first pass rather than assuming a shape we haven't confirmed
    # against real modifier-bound data yet.
    return [str(m) for m in getattr(input_obj, "modifiers", []) or []]


def _sanitize_for_filename(text):
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in text)


class OutputPlugin(OutputPluginInterface):
    plugin_meta = PluginMeta(
        name="MachLink Export",
        version="1.0.0",
        icon_path="img/icon.ico",
    )
    plugin_settings_model = MachLinkExportSettings

    def process_export(self, results: list[ExportResult]) -> bool:
        output_dir_setting = self.get_setting("output_dir")
        output_dir = Path(output_dir_setting) if output_dir_setting else Path(_DEFAULT_OUTPUT_DIR)

        try:
            output_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            _logger.error(f"MachLink Export: couldn't create output folder {output_dir}: {e}")
            return False

        all_ok = True
        for result in results:
            try:
                self._write_device_json(result, output_dir)
            except Exception as e:  # noqa: BLE001 - one bad device shouldn't kill the whole export
                all_ok = False
                _logger.error(
                    f"MachLink Export: failed on device "
                    f"'{result.device_name}' / profile '{result.profile_name}': {e}"
                )
                self._write_debug_note(output_dir, result, e)

        return all_ok

    def _write_device_json(self, result: ExportResult, output_dir: Path) -> None:
        combined_inputs = result.device.get_combined_inputs()

        bindings = []
        for key, input_obj in combined_inputs.items():
            bindings.append(
                {
                    "identifier": _identifier_of(input_obj, key),
                    "command": _command_of(input_obj),
                    "modifiers": _modifiers_of(input_obj),
                }
            )

        data = {
            "profile_name": result.profile_name,
            "device_name": result.device_name,
            "device_guid": result.device_guid,
            "source_plugin": result.source_plugin,
            "binding_count": len(bindings),
            "bindings": bindings,
        }

        filename = f"{_sanitize_for_filename(result.device_guid)}-{_sanitize_for_filename(result.profile_name)}.json"
        with open(output_dir / filename, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def _write_debug_note(self, output_dir: Path, result: ExportResult, error: Exception) -> None:
        # Best-effort - if our assumptions about the Device_/Input_ shape
        # are ever slightly off for some device, this leaves a breadcrumb
        # to fix from instead of a silently missing/incomplete file.
        try:
            note_path = output_dir / "_machlink_export_errors.log"
            with open(note_path, "a", encoding="utf-8") as f:
                f.write(f"{result.profile_name} / {result.device_name}: {error!r}\n")
        except OSError:
            pass
