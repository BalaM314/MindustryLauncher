import { SpawnOptions, SpawnSyncReturns } from "child_process";
import { Transform, TransformCallback, TransformOptions } from "stream";
export declare const ANSIEscape: {
    red: string;
    yellow: string;
    green: string;
    blue: string;
    purple: string;
    white: string;
    gray: string;
    black: string;
    cyan: string;
    reset: string;
    brightpurple: string;
};
export declare function log(message: string): void;
export declare function error(message: string): void;
export declare function debug(message: string): void;
export declare function crash(message: string): never;
/**Returns the proper highlight color for a line based on the character inside [x] */
export declare function getLogHighlight(char: string | undefined): string;
export declare function getTimeComponent(color: boolean): string;
export declare function formatLine(line: string): string;
/**Creates a subclass of Transform from a function that processes one line at a time. */
export declare function streamTransform(transformFunction: (text: string, chunkIndex: number) => string): new (opts?: TransformOptions) => Transform;
/**Creates a subclass of Transform from a function that processes one line at a time. */
export declare function streamTransformState<T>(transformFunction: (text: string, chunkIndex: number, state: T | null) => [output: string, state: T], def?: T | null): new (opts?: TransformOptions) => Transform;
export declare const LoggerHighlightTransform: new (opts?: TransformOptions) => Transform;
export declare function prependTextTransform(text: string | (() => string)): new (opts?: TransformOptions) => Transform;
/**Removes a word from logs. Useful to hide your Windows username.*/
export declare class CensorKeywordTransform extends Transform {
    keyword: string | RegExp;
    replace: string;
    constructor(keyword: string | RegExp, replace: string, opts?: TransformOptions);
    _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void;
}
/**
 * Keeps a running average of some data.
 */
export declare class WindowedMean {
    maxWindowSize: number;
    /** Queue to hold the data. */
    data: Array<[number, number]>;
    /** Index of the next place to insert an item into the queue. */
    queuei: number;
    lastTime: number;
    constructor(maxWindowSize: number);
    add(value: number): void;
    mean(windowSize?: number): number | null;
    mean<T>(windowSize: number, notEnoughDataValue: T): number | T;
}
export declare function askQuestion(query: string): Promise<string>;
export declare function askYesOrNo(query: string): Promise<boolean>;
/**Copies a directory recursively. */
export declare function copyDirectory(source: string, destination: string, exclude?: string): void;
export declare function parseJSONC(data: string): unknown;
export declare function throwIfError(output: SpawnSyncReturns<Buffer>): void;
export declare function stringifyError(err: unknown): string;
export declare function downloadFile(url: string, outputPath: string, changed?: (downloaded: number, total: number) => unknown): Promise<unknown>;
export declare function formatFileSize(bytes: number, b?: string): string;
export declare function resolveRedirect(url: string): Promise<string>;
/** @throws NodeJS.Signals | Error */
export declare function spawnAsync(command: string, args: readonly string[], options?: SpawnOptions): Promise<void>;
/**
 * Allows lazily computing properties of an object.
 * Example usage:
 * ```
 * const foo = memoizeGetters({
 * 	prop1(){
 * 		console.log('reading file');
 * 		return fs.readFileSync('file.json', 'utf-8');
 * 	},
 * 	prop2(){
 * 		console.log('parsing json');
 * 		return JSON.parse(this.prop1());
 * 	}
 * });
 *
 * //Functions are converted to getter properties
 * doSomething(foo.prop1); //outputs 'reading file'
 * doSomething(foo.prop2); //outputs 'parsing json', but not 'reading file'
 * doSomething(foo.prop2); //outputs nothing
 * ```
 */
export declare function memoizeGetters<T extends Record<string, unknown>>(input: {
    [K in keyof T]: () => T[K];
}): T;
