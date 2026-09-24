export function canPrompt(
  stdin: Pick<NodeJS.ReadStream, "isTTY">,
  stdout: Pick<NodeJS.WriteStream, "isTTY">,
): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}
