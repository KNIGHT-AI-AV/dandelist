export interface Mailer {
  sendCode(to: string, code: string): Promise<void>;
}

// Email copy is outward-facing: run it through aitextclean.com before the first production send.
const subject = "Your Dandelist sign-in code";
const body = (code: string) => `Your code is ${code}. It expires in 10 minutes.`;

export function resendMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async sendCode(to, code) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text: body(code) }),
      });
      if (!res.ok) throw new Error(`Resend refused the email: ${res.status} ${await res.text()}`);
    },
  };
}

/** Development only: prints the code instead of emailing it. */
export function consoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    async sendCode(to, code) {
      log(`[dev mail] sign-in code for ${to}: ${code}`);
    },
  };
}
