import { vi } from "vitest";
export const requestUrl = vi.fn();
export const Notice = vi.fn();
export const Plugin = class {};
export const Modal = class { app: unknown; contentEl = { empty: vi.fn(), createEl: vi.fn() }; constructor(app: unknown) { this.app = app; } open = vi.fn(); close = vi.fn(); };
export const PluginSettingTab = class { constructor(_app: unknown, _plugin: unknown) {} display = vi.fn(); };
export const Setting = class { constructor(_el: unknown) {} setName = vi.fn().mockReturnThis(); setDesc = vi.fn().mockReturnThis(); addButton = vi.fn().mockReturnThis(); addText = vi.fn().mockReturnThis(); addToggle = vi.fn().mockReturnThis(); addDropdown = vi.fn().mockReturnThis(); setWarning = vi.fn().mockReturnThis(); };
