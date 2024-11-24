import { AbstractParser, EnclosingContext } from "../../constants";
import Parser from "tree-sitter";
import Python from "tree-sitter-python";

// source: Nawaf-TBE

export class PythonParser implements AbstractParser {
  parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Python);
  }

  findEnclosingContext(
    file: string,
    lineStart: number,
    lineEnd: number
  ): EnclosingContext {
    const ast: Parser.Tree = this.parser.parse(file);
    const root: Parser.SyntaxNode = ast.rootNode;
    let largestSize = 0;
    let largestEnclosingContext: Parser.SyntaxNode = null;

    const traverse = (node: Parser.SyntaxNode) => {
      const { startPosition, endPosition } = node;
      const start = (startPosition.row = 1);
      const end = endPosition.row + 1;

      if (start <= lineStart && lineEnd <= end) {
        const size = end - start;
        if (size > largestSize) {
          largestSize = size;
          largestEnclosingContext = node;
        }
      }
      for (const childNode of node.children) {
        traverse(childNode);
      }
    };
    traverse(root);

    return {
      enclosingContext: largestEnclosingContext,
    } as EnclosingContext;
  }

  dryRun(file: string): { valid: boolean; error: string } {
    try {
      // Parse the file
      this.parser.parse(file);
      return {
        valid: true,
        error: "Error in parsing python file",
      };
    } catch (error) {
      return {
        valid: false,
        error: `Python parsing error. ${error.message}`,
      };
    }
  }

  private processNode = (
    node: Parser.SyntaxNode,
    lineStart: number,
    lineEnd: number,
    largestSize: number,
    largestEnclosingContext: Parser.SyntaxNode | null
  ): {
    largestSize: number;
    largestEnclosingContext: Parser.SyntaxNode | null;
  } => {
    const { startPosition, endPosition } = node;
    if (startPosition.row <= lineStart && lineEnd <= endPosition.row) {
      const size = endPosition.row - startPosition.row;
      if (size > largestSize) {
        largestSize = size;
        largestEnclosingContext = node;
      }
    }
    return { largestSize, largestEnclosingContext };
  };

  private traverseTree = (
    cursor: Parser.TreeCursor,
    lineStart: number,
    lineEnd: number,
    largestSize: number,
    largestEnclosingContext: Parser.SyntaxNode | null
  ): {
    largestSize: number;
    largestEnclosingContext: Parser.SyntaxNode | null;
  } => {
    do {
      const node = cursor.currentNode;
      ({ largestSize, largestEnclosingContext } = this.processNode(
        node,
        lineStart,
        lineEnd,
        largestSize,
        largestEnclosingContext
      ));

      // Traverse children of the current node
      if (cursor.gotoFirstChild()) {
        ({ largestSize, largestEnclosingContext } = this.traverseTree(
          cursor,
          lineStart,
          lineEnd,
          largestSize,
          largestEnclosingContext
        ));
        cursor.gotoParent(); // Return to the parent after processing children
      }
    } while (cursor.gotoNextSibling()); // Move to the next sibling

    return { largestSize, largestEnclosingContext };
  };
}
