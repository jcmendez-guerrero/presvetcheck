/**
 * Envío de correo intercambiable (SPEC §10.1): SMTP (Google Workspace), Azure Communication Services
 * Email (identidad gestionada) o consola (desarrollo: solo asunto y destinatarios, nunca contenido).
 */
export interface Correo {
  para: string[];
  asunto: string;
  texto: string;
  adjuntos?: { nombre: string; mime: string; contenido: Buffer }[];
}

export interface Mailer {
  readonly tipo: 'smtp' | 'acs' | 'console';
  enviar(c: Correo): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  readonly tipo = 'console' as const;
  readonly enviados: Correo[] = [];
  constructor(private readonly log: (m: string) => void = () => {}) {}
  async enviar(c: Correo) {
    this.enviados.push(c);
    this.log(
      `[correo] «${c.asunto}» → ${c.para.length} destinatario(s), ${c.adjuntos?.length ?? 0} adjunto(s)`,
    );
  }
}

export class SmtpMailer implements Mailer {
  readonly tipo = 'smtp' as const;
  constructor(
    private readonly cfg: {
      host: string;
      port: number;
      user?: string | undefined;
      password?: string | undefined;
      from: string;
    },
  ) {}
  async enviar(c: Correo) {
    const { createTransport } = await import('nodemailer');
    const t = createTransport({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.port === 465,
      ...(this.cfg.user ? { auth: { user: this.cfg.user, pass: this.cfg.password ?? '' } } : {}),
    });
    await t.sendMail({
      from: this.cfg.from,
      to: c.para,
      subject: c.asunto,
      text: c.texto,
      attachments: (c.adjuntos ?? []).map((a) => ({
        filename: a.nombre,
        content: a.contenido,
        contentType: a.mime,
      })),
    });
  }
}

export class AcsMailer implements Mailer {
  readonly tipo = 'acs' as const;
  constructor(
    private readonly cfg: { endpoint: string; remitente: string; getToken?: () => Promise<string> },
  ) {}
  async enviar(c: Correo) {
    const token = this.cfg.getToken
      ? await this.cfg.getToken()
      : (
          await new (await import('@azure/identity')).DefaultAzureCredential().getToken(
            'https://communication.azure.com/.default',
          )
        )?.token;
    const res = await fetch(`${this.cfg.endpoint.replace(/\/$/, '')}/emails:send?api-version=2023-03-31`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderAddress: this.cfg.remitente,
        recipients: { to: c.para.map((address) => ({ address })) },
        content: { subject: c.asunto, plainText: c.texto },
        attachments: (c.adjuntos ?? []).map((a) => ({
          name: a.nombre,
          contentType: a.mime,
          contentInBase64: a.contenido.toString('base64'),
        })),
      }),
    });
    if (res.status !== 202) throw new Error(`Azure Communication Services respondió ${res.status}`);
  }
}
