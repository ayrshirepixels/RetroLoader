import json
import os

import decky  # provided by Decky Loader at runtime

DEFAULT_SETTINGS = {
    "themeId": "spectrum",
    "authenticNames": True,     # truncate names the way the machine did
    "includeNonSteam": False,
    "sound": True,
    "haptics": True,
    "loadSpeed": "authentic",   # authentic | quick | instant
}


def _settings_path() -> str:
    directory = decky.DECKY_PLUGIN_SETTINGS_DIR
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, "settings.json")


class Plugin:
    async def _main(self):
        decky.logger.info("Retro Loader ready.")

    async def _unload(self):
        decky.logger.info("Retro Loader unloaded.")

    async def get_settings(self) -> dict:
        path = _settings_path()
        if not os.path.exists(path):
            return dict(DEFAULT_SETTINGS)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                stored = json.load(handle)
        except (json.JSONDecodeError, OSError) as err:
            decky.logger.warning(f"Could not read settings, using defaults: {err}")
            return dict(DEFAULT_SETTINGS)
        merged = dict(DEFAULT_SETTINGS)
        merged.update(stored or {})
        return merged

    async def set_settings(self, settings: dict) -> bool:
        merged = dict(DEFAULT_SETTINGS)
        merged.update(settings or {})
        try:
            with open(_settings_path(), "w", encoding="utf-8") as handle:
                json.dump(merged, handle)
        except OSError as err:
            decky.logger.error(f"Could not write settings: {err}")
            return False
        return True
