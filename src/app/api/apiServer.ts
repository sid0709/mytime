import type {
  ApiServerSettingsDto,
  SetApiServerSettingsDto,
} from "../types/backend";
import { invokeWithFallback } from "./tauri";

const MOCK_SETTINGS: ApiServerSettingsDto = {
  enabled: true,
  port: 18765,
  bind: "0.0.0.0",
  hostname: "dev-machine",
  running: false,
  listenAddr: null,
  apiBaseUrl: "http://127.0.0.1:18765/api/v1",
  error: null,
};

export function getApiServerSettings() {
  return invokeWithFallback<ApiServerSettingsDto>(
    "get_api_server_settings",
    MOCK_SETTINGS,
  );
}

export function setApiServerSettings(settings: SetApiServerSettingsDto) {
  return invokeWithFallback<ApiServerSettingsDto>(
    "set_api_server_settings",
    { ...MOCK_SETTINGS, ...settings },
    { settings },
  );
}
