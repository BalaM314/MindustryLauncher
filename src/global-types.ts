/* @license
Copyright © <BalaM314>, 2024.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains functions that are part of the program code.
*/
/* eslint-disable @typescript-eslint/consistent-type-definitions */


export {};
declare global {
	interface JSON {
		/**
		 * Converts a JavaScript Object Notation (JSON) string into an object.
		 * @param text A valid JSON string.
		 * @param reviver A function that transforms the results. This function is called for each member of the object.
		 * If a member contains nested objects, the nested objects are transformed before the parent object is.
		 */
		parse(text: string, reviver?: (this: {}, key: string, value: unknown) => unknown): {};
		/**
		 * Converts a JavaScript value to a JavaScript Object Notation (JSON) string.
		 * @param value A JavaScript value, usually an object or array, to be converted.
		 * @param replacer A function that transforms the results.
		 * @param space Adds indentation, white space, and line break characters to the return-value JSON text to make it easier to read.
		 */
		stringify(value: {}, replacer?: (this: {}, key: string, value: unknown) => unknown, space?: string | number): string;
		/**
		 * Converts a JavaScript value to a JavaScript Object Notation (JSON) string.
		 * @param value A JavaScript value, usually an object or array, to be converted.
		 * @param replacer An array of strings and numbers that acts as an approved list for selecting the object properties that will be stringified.
		 * @param space Adds indentation, white space, and line break characters to the return-value JSON text to make it easier to read.
		 */
		stringify(value: {}, replacer?: Array<number | string> | null, space?: string | number): string;
	}
	interface ObjectConstructor {
		/**
		 * Returns an array of key/values of the enumerable properties of an object
		 * @param o Object that contains the properties and methods. This can be an object that you created or an existing Document Object Model (DOM) object.
		 */
		entries<const K extends string, T>(o: Record<K, T>): Array<[K, T]>;
		fromEntries<const K extends string, T>(entries: Iterable<readonly [K, T]>): Record<K, T>;
		/**
     * Creates an object that has the specified prototype or that has null prototype.
     * @param o Object to use as a prototype. May be null.
     */
    create(o: object | null): {};

    /**
     * Creates an object that has the specified prototype, and that optionally contains specified properties.
     * @param o Object to use as a prototype. May be null
     * @param properties JavaScript object that contains one or more property descriptors.
     */
    create(o: object | null, properties: PropertyDescriptorMap & ThisType<any>): {};
		setPrototypeOf<T extends object>(o: T, proto: null): T;
	}
	interface Array<T> {
		map<TThis extends T[], U>(this:TThis, fn:(v:T, i:number, a:TThis) => U): number extends TThis["length"] ? U[] : { [K in keyof TThis]: U };
		reverse<TThis extends T[], U>(this:TThis): TThis extends [infer A, infer B] ? [B, A] : T[];
		slice<TThis extends T[]>(this:TThis): TThis;
		includes(searchElement:unknown, searchIndex?:number):searchElement is T;
		filter(boolean:BooleanConstructor): Array<T extends (false | null | undefined) ? never : T>;
	}
	interface ReadonlyArray<T> {
		map<TThis extends T[], U>(this:TThis, fn:(v:T, i:number, a:TThis) => U): number extends TThis["length"] ? readonly U[] : { [K in keyof TThis]: U };
		slice<TThis extends T[]>(this:TThis): TThis;
		includes(searchElement:unknown, searchIndex?:number):searchElement is T;
	}
	interface ArrayConstructor {
		isArray(arg: unknown): arg is unknown[];
	}
	interface Function {
		displayName?: string;
	}
	interface SymbolConstructor {
		readonly metadata: unique symbol;
	}
}
