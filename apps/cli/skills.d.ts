declare const skills: {
  skillRoot(): string;
  readSkill(name: string): string;
  listSkills(env?: NodeJS.ProcessEnv): { name: string; source: string; revision: string; license: string; default: boolean }[];
  skillCommands(): Record<string, { description: string; template: string }>;
  defaultInstructions(env?: NodeJS.ProcessEnv): string;
  defaultSkills(env?: NodeJS.ProcessEnv): string[];
  configureDefaultSkills(names: string[], env?: NodeJS.ProcessEnv): string[];
};
export = skills;
