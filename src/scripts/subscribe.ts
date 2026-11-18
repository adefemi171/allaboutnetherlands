// Newsletter sign-up forms (see components/Subscribe.astro).

const SEND_TIMEOUT = 15_000;

function setup(form: HTMLFormElement): void {
  const email = form.querySelector<HTMLInputElement>('[name="email"]');
  const trap = form.querySelector<HTMLInputElement>('[name="_gotcha"]');
  const note = form.querySelector<HTMLElement>("[data-subscribe-note]");
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]');
  const endpoint = form.dataset.endpoint ?? "";
  const mail = form.dataset.mail ?? "";

  /** A mail program address with the request to sign up filled in. */
  const byMail = (to: string, address: string) =>
    `${to}${to.includes("?") ? "&" : "?"}subject=${encodeURIComponent("Newsletter: sign me up")}` +
    `&body=${encodeURIComponent(`Please add ${address} to the All About Netherlands newsletter.`)}`;
  if (!email || !note || !button || !endpoint) return;

  const say = (text: string, state: "error" | "done") => {
    note.textContent = text;
    note.classList.toggle("is-error", state === "error");
    note.classList.toggle("is-done", state === "done");
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = email.value.trim();
    if (!address || !email.checkValidity()) {
      say("That email address does not look complete.", "error");
      email.focus();
      return;
    }
    // Filled in by a program. Say thanks and send nothing.
    if (trap?.value) return say("You are signed up.", "done");

    if (/^mailto:/i.test(endpoint)) {
      window.location.href = byMail(endpoint, address);
      return say(
        "Your mail program should now open with the request filled in. You are signed up once you press send there.",
        "done",
      );
    }

    button.disabled = true;
    const label = button.textContent;
    button.textContent = "Sending";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email: address,
          page: location.href,
          _subject: "Newsletter sign-up",
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Some services answer 200 and say in the body that they refused.
      const answer = (await response.json().catch(() => null)) as { success?: unknown } | null;
      if (answer && String(answer.success) === "false") throw new Error("Refused");
      form.reset();
      say(`You are signed up with ${address}.`, "done");
    } catch {
      say("That did not go through. Your address is still in the box, so you can try again in a moment.", "error");
      if (mail) {
        const link = document.createElement("a");
        link.href = byMail(mail, address);
        link.textContent = "Or sign up by email instead.";
        note.append(" ", link);
      }
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}

document.querySelectorAll<HTMLFormElement>("[data-subscribe]").forEach((form) => {
  if (form.dataset.ready) return;
  form.dataset.ready = "true";
  setup(form);
});

// Makes this file a module, so its names stay its own.
export {};
