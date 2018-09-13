import * as _ from "lodash";

import { logger } from "@atomist/automation-client";
import { File } from "@atomist/automation-client/project/File";
import { FileParser } from "@atomist/automation-client/tree/ast/FileParser";
import {
    fillInEmptyNonTerminalValues,
    isNamedNodeTest,
    isUnionPathExpression,
    NamedNodeTest,
    NodeTest,
    PathExpression,
    stringify,
    TreeNode,
} from "@atomist/tree-path";
import { ANTLRInputStream, CommonTokenStream, Lexer, Parser, TokenStream } from "antlr4ts";
import { TreeBuildingListener } from "./TreeBuildingListener";

/**
 * Required functions on a lexer class generated by ANTLR
 */
export interface LexerClass {

    readonly ruleNames: string[];

    new(is: ANTLRInputStream): Lexer;

    // Expected but unfortunately private so can't be put on interface
    // readonly _SYMBOLIC_NAMES: (string | undefined)[];

}

/**
 * Required functions on a parser class generated by ANTLR
 */
export interface ParserClass {

    readonly ruleNames: string[];

    new(ts: TokenStream): Parser;

}

/**
 * Generic FileParser implementation based on an ANTLR grammars.
 */
export class AntlrFileParser implements FileParser {

    /**
     * Create a generic FileParser using an ANTLR grammar.
     * Use like this, passing in the lexer and parser classes:
     * const p = new AntlrFileParser("compilationUnit", JavaLexer, JavaParser);
     * @param {string} rootName name of top level production.
     * @param lexerClass lexer class
     * @param parserClass parser class
     */
    constructor(public rootName: string,
                private readonly lexerClass: LexerClass,
                private readonly parserClass: ParserClass) {
    }

    public toAst(f: File): Promise<TreeNode> {
        return f.getContent()
            .then(content => {
                logger.debug("Parsing file [%s] using ANTLR grammar, looking for production '%s'",
                    f.path, this.rootName);
                const inputStream = new ANTLRInputStream(content);
                const lexer = new this.lexerClass(inputStream);
                const tokenStream = new CommonTokenStream(lexer);
                const parser = new this.parserClass(tokenStream);
                const mbl = new TreeBuildingListener(
                    i => this.parserClass.ruleNames[i],
                    i => (this.lexerClass as any)._SYMBOLIC_NAMES[i]);
                parser.addParseListener(mbl);
                (parser as any)[this.rootName]();
                // logger.debug(cu.toStringTree());
                fillInEmptyNonTerminalValues(mbl.root, content);
                return mbl.root;
            });
    }

    public validate(pex: PathExpression): void {
        // Create instance so we can check productions
        const parserInstance = new this.parserClass(undefined) as any;

        // Check that all names referenced correspond to productions in the grammar
        const nameNodeTests: NamedNodeTest[] = allNodeTests(pex)
            .filter(t => isNamedNodeTest(t))
            .map(nt => nt as NamedNodeTest);
        nameNodeTests.forEach(nt => {
            if (!(parserInstance[nt.name] || this.lexerClass.ruleNames.includes(nt.name))) {
                throw new Error(`Invalid path expression ${stringify(pex)}: No such production or terminal '${nt.name}'`);
            }
        });
    }
}

// TODO will be available in tree-path 0.1.9
function allNodeTests(pe: PathExpression): NodeTest[] {
    return isUnionPathExpression(pe) ?
        _.flatten(pe.unions.map(u => allNodeTests(u))) :
        _.flatten(pe.locationSteps.map(s => s.test));
}
