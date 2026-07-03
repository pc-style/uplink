import { Command } from "./command";
import { authCommand } from "./commands/auth";
import { uploadCommand } from "./commands/upload";
import { uploadUrlCommand } from "./commands/upload-url";
import { ingestCommand } from "./commands/ingest";
import { signCommand } from "./commands/sign";
import { infoCommand } from "./commands/info";
import { downloadCommand } from "./commands/download";
import { syncCommand } from "./commands/sync";

const program = new Command("uplink")
  .description("up!link CLI — upload, manage, and share files via Cloudflare R2")
  .version("0.1.0")
  .addCommand(authCommand)
  .addCommand(uploadCommand)
  .addCommand(uploadUrlCommand)
  .addCommand(ingestCommand)
  .addCommand(signCommand)
  .addCommand(infoCommand)
  .addCommand(downloadCommand)
  .addCommand(syncCommand);

await program.parse(process.argv);
