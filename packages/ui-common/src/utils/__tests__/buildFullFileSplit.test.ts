import { describe, expect, it } from "vitest";
import { buildFullFileSplit } from "../buildFullFileSplit";

describe("buildFullFileSplit", () => {
  it("emits equal rows for unchanged content", () => {
    const rows = buildFullFileSplit("a\nb\nc\n", "a\nb\nc\n");
    expect(rows).toEqual([
      {
        type: "equal",
        oldLine: "a",
        newLine: "a",
        oldLineNumber: 1,
        newLineNumber: 1,
      },
      {
        type: "equal",
        oldLine: "b",
        newLine: "b",
        oldLineNumber: 2,
        newLineNumber: 2,
      },
      {
        type: "equal",
        oldLine: "c",
        newLine: "c",
        oldLineNumber: 3,
        newLineNumber: 3,
      },
    ]);
  });

  it("pairs adjacent delete + insert blocks into replace rows", () => {
    const rows = buildFullFileSplit("a\nB\nc\n", "a\nb\nc\n");
    expect(rows).toEqual([
      {
        type: "equal",
        oldLine: "a",
        newLine: "a",
        oldLineNumber: 1,
        newLineNumber: 1,
      },
      {
        type: "replace",
        oldLine: "B",
        newLine: "b",
        oldLineNumber: 2,
        newLineNumber: 2,
      },
      {
        type: "equal",
        oldLine: "c",
        newLine: "c",
        oldLineNumber: 3,
        newLineNumber: 3,
      },
    ]);
  });

  it("pads the shorter side when a replace block is uneven", () => {
    const rows = buildFullFileSplit("a\nX\nY\nb\n", "a\nx\nb\n");
    expect(rows).toEqual([
      {
        type: "equal",
        oldLine: "a",
        newLine: "a",
        oldLineNumber: 1,
        newLineNumber: 1,
      },
      {
        type: "replace",
        oldLine: "X",
        newLine: "x",
        oldLineNumber: 2,
        newLineNumber: 2,
      },
      {
        type: "delete",
        oldLine: "Y",
        newLine: null,
        oldLineNumber: 3,
        newLineNumber: null,
      },
      {
        type: "equal",
        oldLine: "b",
        newLine: "b",
        oldLineNumber: 4,
        newLineNumber: 3,
      },
    ]);
  });

  it("keeps changed lines correlated across an unrelated insertion", () => {
    const rows = buildFullFileSplit(
      "return resolveCustomer(customerId);\nreturn resolveInvoice(invoiceId);\n",
      "return mapCustomer(customerId);\nconst auditRecord = createAuditRecord();\nreturn mapInvoice(invoiceId);\n",
    );

    expect(rows).toEqual([
      {
        type: "replace",
        oldLine: "return resolveCustomer(customerId);",
        newLine: "return mapCustomer(customerId);",
        oldLineNumber: 1,
        newLineNumber: 1,
      },
      {
        type: "insert",
        oldLine: null,
        newLine: "const auditRecord = createAuditRecord();",
        oldLineNumber: null,
        newLineNumber: 2,
      },
      {
        type: "replace",
        oldLine: "return resolveInvoice(invoiceId);",
        newLine: "return mapInvoice(invoiceId);",
        oldLineNumber: 2,
        newLineNumber: 3,
      },
    ]);
  });

  it("emits standalone insert rows for net additions", () => {
    const rows = buildFullFileSplit("a\nc\n", "a\nb\nc\n");
    expect(rows).toEqual([
      {
        type: "equal",
        oldLine: "a",
        newLine: "a",
        oldLineNumber: 1,
        newLineNumber: 1,
      },
      {
        type: "insert",
        oldLine: null,
        newLine: "b",
        oldLineNumber: null,
        newLineNumber: 2,
      },
      {
        type: "equal",
        oldLine: "c",
        newLine: "c",
        oldLineNumber: 2,
        newLineNumber: 3,
      },
    ]);
  });

  it("emits standalone delete rows for net removals", () => {
    const rows = buildFullFileSplit("a\nb\nc\n", "a\nc\n");
    expect(rows).toEqual([
      {
        type: "equal",
        oldLine: "a",
        newLine: "a",
        oldLineNumber: 1,
        newLineNumber: 1,
      },
      {
        type: "delete",
        oldLine: "b",
        newLine: null,
        oldLineNumber: 2,
        newLineNumber: null,
      },
      {
        type: "equal",
        oldLine: "c",
        newLine: "c",
        oldLineNumber: 3,
        newLineNumber: 2,
      },
    ]);
  });

  it("renders an added file (preContent === null) entirely as inserts", () => {
    const rows = buildFullFileSplit(null, "x\ny\n");
    expect(rows).toEqual([
      {
        type: "insert",
        oldLine: null,
        newLine: "x",
        oldLineNumber: null,
        newLineNumber: 1,
      },
      {
        type: "insert",
        oldLine: null,
        newLine: "y",
        oldLineNumber: null,
        newLineNumber: 2,
      },
    ]);
  });

  it("renders a deleted file (postContent === null) entirely as deletes", () => {
    const rows = buildFullFileSplit("x\ny\n", null);
    expect(rows).toEqual([
      {
        type: "delete",
        oldLine: "x",
        newLine: null,
        oldLineNumber: 1,
        newLineNumber: null,
      },
      {
        type: "delete",
        oldLine: "y",
        newLine: null,
        oldLineNumber: 2,
        newLineNumber: null,
      },
    ]);
  });

  it("returns no rows when both sides are null", () => {
    expect(buildFullFileSplit(null, null)).toEqual([]);
  });

  it("returns no rows when both sides are empty", () => {
    expect(buildFullFileSplit("", "")).toEqual([]);
  });

  it("normalizes CRLF line endings", () => {
    const rows = buildFullFileSplit("a\r\nb\r\n", "a\r\nb\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[0].oldLine).toBe("a");
    expect(rows[1].oldLine).toBe("b");
  });
});
