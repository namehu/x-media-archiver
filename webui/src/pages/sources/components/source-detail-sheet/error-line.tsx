export function ErrorLine({ error }: { error: unknown }) {
  return <p className="basis-full text-sm text-danger">{String(error)}</p>;
}
