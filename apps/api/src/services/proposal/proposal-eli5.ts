/** A concise write-time explanation for actions that author a proposal directly. */
export function explainFieldUpdate(entity: string, fields: string[]): string {
  const names = fields.map((field) =>
    field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
  );
  const listed = names.slice(0, 3).join(', ');
  const remaining = names.length - 3;
  const suffix = remaining > 0 ? ` and ${remaining} more` : '';
  return `Changes this ${entity}'s ${listed}${suffix}.`;
}
