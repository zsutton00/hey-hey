import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('V2026.10.21.110000: move Eval types out of the Explorer menu', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.10.21.110000__move_eval_types_out_of_the_explorer_menu.sql',
    ),
    'utf8',
  );

  it.each(['work_item_type_template', 'work_item_type'])(
    'gives Eval and Eval Case the monitor role and hides them in %s',
    (table) => {
      const statement = sql
        .split(';')
        .find((part) => part.includes(`UPDATE ${table}\n`));
      expect(statement).toContain("role = 'monitor'");
      expect(statement).toContain(`'{showsInExplorerSidebar}', 'false'::jsonb`);
      expect(statement).toContain("type_key IN ('EVAL', 'EVAL_CASE')");
    },
  );
});
