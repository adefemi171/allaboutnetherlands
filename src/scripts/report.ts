// "Report a problem" (see components/Report.astro).
//
// Anything with data-report-open opens the form. A page can add what it
// knows by listening for "aan:report" and pushing lines onto detail.notes;
// the map adds where the camera is.

interface Report {
  message: string;
  email?: string;
  /** Address and title of the page the report is about. */
  page: string;
  title: string;
  /** Extra lines from the page, such as the position of the map. */
  context?: string;
  /** Subject line, for form services that turn the report into an email. */
  _subject: string;
}

const SEND_TIMEOUT = 15_000;

function setup(dialog: HTMLDialogElement): void {
  const find = <T extends HTMLElement>(selector: string) =>
    dialog.querySelector<T>(selector);
  const form = find<HTMLFormElement>("[data-report-form]");
  const message = find<HTMLTextAreaElement>("#report-message");
  const email = find<HTMLInputElement>("#report-email");
  const trap = find<HTMLInputElement>('[name="_gotcha"]');
  const page = find("[data-report-page]");
  const error = find("[data-report-error]");
  const send = find<HTMLButtonElement>("[data-report-send]");
  const done = find("[data-report-done]");
  const doneTitle = find("[data-report-done-title]");
  const doneText = find("[data-report-done-text]");
  const endpoint = dialog.dataset.endpoint ?? "";
  const mail = dialog.dataset.mail ?? "";
  if (!form || !message || !email || !error || !send || !done || !doneText || !endpoint) {
    return;
  }

  const title = () => document.title.split(" · ")[0];
  let notes: string[] = [];

  const fail = (text: string, field?: HTMLElement) => {
    error.textContent = text;
    error.hidden = false;
    field?.focus();
  };

  /** A mail program address with the report filled in. */
  const byMail = (address: string, report: Report) => {
    const body = [
      report.message,
      "",
      `Page: ${report.page}`,
      ...(report.context ? [report.context] : []),
    ].join("\n");
    const separator = address.includes("?") ? "&" : "?";
    return (
      `${address}${separator}subject=${encodeURIComponent(report._subject)}` +
      `&body=${encodeURIComponent(body)}`
    );
  };

  const open = () => {
    // Text that was typed and not sent is still there. A report that was
    // sent leaves an empty form.
    form.hidden = false;
    done.hidden = true;
    error.hidden = true;
    const context = { notes: [] as string[] };
    window.dispatchEvent(new CustomEvent("aan:report", { detail: context }));
    notes = context.notes;
    if (page) page.textContent = `${title()} (${location.pathname})`;
    if (!dialog.open) dialog.showModal();
    message.focus();
  };

  const finish = (text: string) => {
    form.reset();
    form.hidden = true;
    doneText.textContent = text;
    done.hidden = false;
    doneTitle?.focus();
  };

  document.addEventListener("click", (event) => {
    const opener = (event.target as Element | null)?.closest("[data-report-open]");
    if (!opener) return;
    event.preventDefault();
    open();
  });
  for (const button of dialog.querySelectorAll("[data-report-close]")) {
    button.addEventListener("click", () => dialog.close());
  }
  // A click on the dimmed page around the form closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const text = message.value.trim();
    if (text.length < 5) {
      return fail("Say in a few words what is wrong.", message);
    }
    if (email.value.trim() && !email.checkValidity()) {
      return fail("That email address does not look complete. Fix it or leave it empty.", email);
    }
    // Filled in by a program. Say thanks and send nothing.
    if (trap?.value) return finish("Your report has been sent.");

    const report: Report = {
      message: text,
      page: location.href,
      title: title(),
      _subject: `Report a problem: ${title()}`,
    };
    if (email.value.trim()) report.email = email.value.trim();
    if (notes.length) report.context = notes.join("\n");

    if (/^mailto:/i.test(endpoint)) {
      window.location.href = byMail(endpoint, report);
      return finish(
        "Your mail program should now open with the report filled in. It is sent once you press send there.",
      );
    }

    send.disabled = true;
    const label = send.textContent;
    send.textContent = "Sending";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(SEND_TIMEOUT),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Some services answer 200 and say in the body that they refused.
      const answer = (await response.json().catch(() => null)) as { success?: unknown } | null;
      if (answer && String(answer.success) === "false") throw new Error("Refused");
      finish(
        report.email
          ? "Your report has been sent, with your email address in case there is a question about it."
          : "Your report has been sent.",
      );
    } catch {
      fail("The report could not be sent from this page. Your text is still here, so you can try again in a moment.");
      if (mail) {
        const link = document.createElement("a");
        link.href = byMail(mail, report);
        link.textContent = "Or send it as an email instead.";
        error.append(" ", link);
      }
    } finally {
      send.disabled = false;
      send.textContent = label;
    }
  });
}

const dialog = document.querySelector<HTMLDialogElement>("[data-report]");
if (dialog && !dialog.dataset.ready) {
  dialog.dataset.ready = "true";
  setup(dialog);
}
