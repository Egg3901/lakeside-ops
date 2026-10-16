declare const skills: {
  skillRoot(): string;
  readSkill(name: string): string;
  listSkills(): { name: string; source: string; revision: string; license: string; default: boolean }[];
  skillCommands(): Record<string, { description: string; template: string }>;
  defaultInstructions(): string;
};
export = skills;
