function mulberry32(a: number) {
    return () => {
        a += 0x6d2b79f5;
        a = a % 4294967296;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Use xmur3 to generate a 32 bit value from the seed string,
 * and use that to set the initial state of mulberry32.
 * @param seed
 */
export function getPseudoRandomNumberGenerator(seed: number) {
    return mulberry32(seed);
}

const rand = getPseudoRandomNumberGenerator(2751647778);
export function getRandomInteger(max, min = 0) {
    const r = min + Math.floor(rand() * (max - min));
    return r;
}

export function strictEquals<G>(a: G, b: G) {
    return a === b;
}

export function delay(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
