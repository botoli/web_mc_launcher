import backgrounds from "./player-backgrounds.json";

export type PlayerTheme = keyof typeof backgrounds;
export const playerBackgrounds = backgrounds;
