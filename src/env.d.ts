interface ImportMetaEnv {
  /** Where reports about mistakes are sent. See src/data/report.ts. */
  readonly PUBLIC_REPORT_ENDPOINT?: string;
  /** Where newsletter sign-ups are sent. See src/data/report.ts. */
  readonly PUBLIC_NEWSLETTER_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
