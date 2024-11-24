import { PythonParser } from "./python-parser";

export class PythonNotebookParser extends PythonParser {
  constructor() {
    super(); // Call the parent constructor
  }

  /**
   * Extracts code and non-code cells from a Jupyter Notebook file.
   */
  private extractCodeAndNonCode(file: string): {
    codeCells: string[];
    nonCodeCells: any[];
  } {
    const notebook = JSON.parse(file);
    const codeCells: string[] = [];
    const nonCodeCells: any[] = [];

    notebook.cells.forEach((cell: any) => {
      if (cell.cell_type === "code") {
        const sourceCode = cell.source.join("");
        codeCells.push(sourceCode);
      } else {
        nonCodeCells.push(cell);
      }
    });

    return { codeCells, nonCodeCells };
  }

  /**
   * Finds the enclosing context in all code cells of a notebook.
   * Combines code cells and calls the parent `findEnclosingContext`.
   */
  findEnclosingContext(file: string, lineStart: number, lineEnd: number): any {
    const { codeCells } = this.extractCodeAndNonCode(file);
    const combinedCode = codeCells.join("\n"); // Combine all code cells into one string
    return super.findEnclosingContext(combinedCode, lineStart, lineEnd);
  }

  /**
   * Validates all code cells of a notebook by combining and parsing them.
   * Uses the parent `dryRun` method.
   */
  dryRun(file: string): { valid: boolean; error: string } {
    const { codeCells } = this.extractCodeAndNonCode(file);
    const combinedCode = codeCells.join("\n");
    return super.dryRun(combinedCode);
  }
}
