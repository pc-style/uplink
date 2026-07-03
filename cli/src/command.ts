export type Option = {
  flags: string;
  description: string;
  defaultValue?: string;
};

export type CommandAction = (args: string[], options: Record<string, string | boolean>) => Promise<void> | void;

export class Command {
  private options: Option[] = [];
  private commands: { name: string; cmd: Command }[] = [];
  private _action?: CommandAction;
  private _description = "";
  private _version = "0.1.0";
  private _usage?: string;

  constructor(private _name: string) {}

  description(desc: string): this {
    this._description = desc;
    return this;
  }

  version(v: string): this {
    this._version = v;
    return this;
  }

  usage(u: string): this {
    this._usage = u;
    return this;
  }

  option(flags: string, description: string, defaultValue?: string): this {
    this.options.push({ flags, description, defaultValue });
    return this;
  }

  action(fn: CommandAction): this {
    this._action = fn;
    return this;
  }

  addCommand(cmd: Command): this {
    this.commands.push({ name: cmd._name, cmd });
    return this;
  }

  async parse(argv: string[]): Promise<void> {
    const args = argv.slice(2);
    if (args.includes("--version") || args.includes("-V")) {
      console.log(this._version);
      return;
    }
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      this.printHelp();
      return;
    }

    const subName = args[0];
    const sub = this.commands.find((c) => c.name === subName);
    if (sub) {
      await sub.cmd.parse([argv[0], argv[1], ...args.slice(1)]);
      return;
    }

    if (args[0] === "--help" || args[0] === "-h") {
      this.printHelp();
      return;
    }

    const { positional, options } = this.parseArgs(args);
    if (this._action) {
      await this._action(positional, options);
    } else {
      this.printHelp();
    }
  }

  private parseArgs(args: string[]): { positional: string[]; options: Record<string, string | boolean> } {
    const positional: string[] = [];
    const options: Record<string, string | boolean> = {};

    for (const opt of this.options) {
      if (opt.defaultValue !== undefined) {
        options[canonicalOptionKey(opt)] = opt.defaultValue;
      }
    }

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith("--")) {
        const eqIdx = arg.indexOf("=");
        if (eqIdx !== -1) {
          const key = arg.slice(2, eqIdx);
          const optDef = findOptionDef(this.options, key);
          options[optDef ? canonicalOptionKey(optDef) : key] = arg.slice(eqIdx + 1);
        } else {
          const key = arg.slice(2);
          const optDef = findOptionDef(this.options, key);
          if (optDef && optionTakesValue(optDef) && i + 1 < args.length && !args[i + 1].startsWith("-")) {
            options[canonicalOptionKey(optDef)] = args[++i];
          } else {
            options[optDef ? canonicalOptionKey(optDef) : key] = true;
          }
        }
      } else if (arg.startsWith("-") && arg.length === 2) {
        const key = arg.slice(1);
        const optDef = this.options.find((o) => o.flags.split(",").some((part) => optionFlagName(part) === key));
        if (optDef && optionTakesValue(optDef) && i + 1 < args.length && !args[i + 1].startsWith("-")) {
          options[canonicalOptionKey(optDef)] = args[++i];
        } else {
          options[optDef ? canonicalOptionKey(optDef) : key] = true;
        }
      } else {
        positional.push(arg);
      }
    }
    return { positional, options };
  }

  private printHelp(): void {
    const usage = this._usage || [this._name, ...this.commands.map((c) => c.name)].join(" ");
    console.log(`\n  ${this._description}\n`);
    console.log(`  Usage: ${usage}`);
    if (this.commands.length > 0) {
      console.log("\n  Commands:");
      for (const c of this.commands) {
        console.log(`    ${c.name.padEnd(16)} ${c.cmd._description}`);
      }
    }
    if (this.options.length > 0) {
      console.log("\n  Options:");
      for (const opt of this.options) {
        const def = opt.defaultValue !== undefined ? ` (default: ${opt.defaultValue})` : "";
        console.log(`    ${opt.flags.padEnd(22)} ${opt.description}${def}`);
      }
    }
    console.log(`\n  --help, -h            Show help`);
    console.log(`  --version, -V         Show version\n`);
  }
}

function canonicalOptionKey(opt: Option): string {
  const long = opt.flags
    .split(",")
    .map((s) => s.trim())
    .find((part) => part.startsWith("--"));
  const raw = (long ?? opt.flags.split(",")[0].trim()).split(/\s+/)[0].replace(/^-+/, "");
  return raw.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function optionTakesValue(opt: Option): boolean {
  return /<[^>]+>/.test(opt.flags);
}

/** Long/short flag name only (strips `<value>` placeholders). */
function optionFlagName(flagPart: string): string {
  return flagPart.trim().split(/\s+/)[0].replace(/^-+/, "");
}

function findOptionDef(options: Option[], key: string): Option | undefined {
  return options.find((o) =>
    o.flags.split(",").some((part) => optionFlagName(part) === key),
  );
}
