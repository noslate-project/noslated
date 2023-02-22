import { FunctionProfileUpdateEvent } from '#self/lib/function_profile';

export const events = [FunctionProfileUpdateEvent].map(it => it.type);
