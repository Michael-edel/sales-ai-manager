// Keep the platform-only socket import out of the portable handler/test module.
import { connect } from "cloudflare:sockets";
import worker, { type Env } from "./index";
export { PasswordKdf } from "./lib/password-kdf-object";
export default {
  ...worker,
  fetch(request: Request, env: Env) {
    return worker.fetch(request, { ...env, SMTP_CONNECT: connect });
  },
} satisfies ExportedHandler<Env>;
