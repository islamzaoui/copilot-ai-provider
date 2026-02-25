export function safeJSONStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "{}";
	}
}
