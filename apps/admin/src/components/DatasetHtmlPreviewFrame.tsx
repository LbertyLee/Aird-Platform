/** Sandboxed iframe for dataset/knowledge HTML previews (e.g. DOCX with tables). */
export function DatasetHtmlPreviewFrame({
  title,
  html,
}: {
  title: string;
  html: string;
}) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox=""
      referrerPolicy="no-referrer"
      style={{ display: 'block', width: '100%', height: '68vh', border: 0 }}
    />
  );
}
