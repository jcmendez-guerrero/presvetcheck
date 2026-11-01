import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmtpMailer } from '../src/mailer';

// El transporte SMTP real nunca se abre en las pruebas: se capturan los argumentos que recibe nodemailer.
const sendMail = vi.fn<(_m: Record<string, unknown>) => Promise<{ messageId: string }>>(async () => ({
  messageId: 'x',
}));
const createTransport = vi.fn<(_o: Record<string, unknown>) => { sendMail: typeof sendMail }>(() => ({
  sendMail,
}));
vi.mock('nodemailer', () => ({ createTransport }));

const correo = {
  para: ['informes@ejemplo.test', 'veterinaria@ejemplo.test'],
  asunto: 'Informe semanal de salidas',
  texto: 'Adjunto el informe de la semana.',
  adjuntos: [
    {
      nombre: 'salidas.xlsx',
      contenido: Buffer.from('contenido'),
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  ],
};

describe('SmtpMailer (envío de informes por correo)', () => {
  beforeEach(() => {
    sendMail.mockClear();
    createTransport.mockClear();
  });

  it('pasa a nodemailer el servidor, la autenticación y el mensaje sin cambios', async () => {
    await new SmtpMailer({
      host: 'smtp.ejemplo.test',
      port: 587,
      user: 'usuario',
      password: 'clave',
      from: 'Mundo Mascotix <no-responder@ejemplo.test>',
    }).enviar(correo);
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.ejemplo.test',
      port: 587,
      secure: false,
      auth: { user: 'usuario', pass: 'clave' },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Mundo Mascotix <no-responder@ejemplo.test>',
      to: correo.para,
      subject: correo.asunto,
      text: correo.texto,
      attachments: [
        {
          filename: 'salidas.xlsx',
          content: correo.adjuntos[0]!.contenido,
          contentType: correo.adjuntos[0]!.mime,
        },
      ],
    });
  });

  it.each([
    { port: 465, secure: true },
    { port: 587, secure: false },
    { port: 25, secure: false },
  ])('puerto $port → conexión cifrada desde el inicio: $secure', async ({ port, secure }) => {
    await new SmtpMailer({ host: 'smtp.ejemplo.test', port, from: 'no-responder@ejemplo.test' }).enviar(
      correo,
    );
    expect(createTransport).toHaveBeenCalledWith({ host: 'smtp.ejemplo.test', port, secure });
  });

  it('sin usuario no envía credenciales y sin adjuntos manda una lista vacía', async () => {
    await new SmtpMailer({ host: 'smtp.ejemplo.test', port: 587, from: 'no-responder@ejemplo.test' }).enviar({
      para: ['informes@ejemplo.test'],
      asunto: 'a',
      texto: 'b',
    });
    expect(createTransport.mock.calls[0]![0]).not.toHaveProperty('auth');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['informes@ejemplo.test'], attachments: [] }),
    );
  });
});
