/**
 * This code was heavily inspired by Angular's original Signal implementation
 */

/**
 * Store a map using a [......[K, V][]]
 */
export class LinearMap<K, V> {
    private internalArray: Array<K | V | null> = [];

    public size = 0;
    get(key: K): V | undefined {
        for (let i = 0, len = this.internalArray.length; i < len; i += 2) {
            const k = this.internalArray[i];
            if (k === key) {
                return this.internalArray[i + 1] as V;
            }
        }
        return undefined;
    }

    set(key: K, value: V): void {
        let nullIndex: number | null = null;
        for (let i = 0, len = this.internalArray.length; i < len; i += 2) {
            if (this.internalArray[i] === key) {
                this.internalArray[i + 1] = value;
                return;
            } else if (nullIndex === null && this.internalArray[i] === null) {
                nullIndex = i;
            }
        }
        this.size += 1;
        if (nullIndex !== null) {
            this.internalArray[nullIndex] = key;
            this.internalArray[nullIndex + 1] = value;
            return;
        }
        this.internalArray.push(key, value);
    }

    delete(key: K): void {
        for (let i = 0, len = this.internalArray.length; i < len; i += 2) {
            if (this.internalArray[i] === key) {
                this.internalArray[i] = this.internalArray[i + 1] = null;
                this.size -= 1;
                break;
            }
        }
    }

    deleteIndex(i: number): void {
        this.internalArray[i] = this.internalArray[i + 1] = null;
        this.size -= 1;
    }

    public *[Symbol.iterator]() {
        yield* this.toTuples();
    }

    public *entries() {
        yield* this.toTuples();
    }

    toTuples(): [K, V][] {
        const result: [K, V][] = [];
        for (let i = 0, len = this.internalArray.length; i < len; i += 2) {
            if (this.internalArray[i] !== null && this.internalArray[i + 1] !== null) {
                result.push([this.internalArray[i] as K, this.internalArray[i + 1] as V]);
            }
        }

        return result;
    }

    defragment(): void {
        let i = 0;
        for (const [key, value] of this.toTuples()) {
            this.internalArray[i] = key;
            this.internalArray[i + 1] = value;
            i += 2;
        }
        this.internalArray.length = i;
    }
}

interface Consumer {
    /**
     * The list of producers previously consumed, along with the valueVersion they produced
     */
    producers: LinearMap<Producer<any>, number> | Map<Producer<any>, number>;

    readonly ref: WeakRef<this>;

    readonly trackingVersion: number;

    notify(producer?: Producer): void;
}

export interface Producer<T = unknown> {
    /**
     * The list of consumers known to consume this producer, along with the trackingVersion
     */
    consumers: LinearMap<WeakRef<Consumer>, number> | Map<WeakRef<Consumer>, number>;

    valueVersion: number;

    checkForActuallyChangedValue(): void;

    readonly value: DeepReadonly<T>;
}

const UNSET: any = Symbol('unset');
const COMPUTING: any = Symbol('computing');

export abstract class Pipeline<T> implements Producer<T>, Consumer {
    public consumers = new LinearMap<WeakRef<Consumer>, number>();
    public producers = new LinearMap<Producer<any>, number>();
    public valueVersion = 1;
    public trackingVersion = 1;
    public readonly ref = new WeakRef(this);

    private stale: boolean | Producer = true;
    /**
     * Clears the stale flag when the value is determined to not be stale.
     */
    checkForActuallyChangedValue(): void {
        if (this.stale === false) {
            return;
        }

        if (this._value !== UNSET && this._value !== COMPUTING) {
            const depsChanged = consumerPollValueStatus(this, this.stale);
            if (!depsChanged) {
                this.stale = false;
                return;
            }
        }

        this.recomputeValue();
    }

    private recomputeValue() {
        if (this._value === COMPUTING) {
            throw new Error('Pipeline is circular');
        }

        const oldValue = this._value;
        this._value = COMPUTING;
        ++this.trackingVersion;
        const prevConsumer = setActiveConsumer(this);
        let newValue: T;
        try {
            newValue = this.calculate();
        } finally {
            setActiveConsumer(prevConsumer);
        }

        this.stale = false;

        if (newValue === oldValue) {
            this._value = oldValue;
            return;
        }
        this._value = newValue;
        ++this.valueVersion;
    }
    private _value: T = UNSET as T;

    public get value() {
        this.checkForActuallyChangedValue();

        producerAccessed(this);

        return this._value as DeepReadonly<T>;
    }
    public notify(notifier?: Producer) {
        if (this.stale !== false) {
            return;
        }
        if (this._value === COMPUTING) {
            throw new Error('Pipeline marked changed while calculating');
        }
        this.stale = notifier ?? true;

        producerNotifyConsumers(this);
    }
    protected abstract calculate(): T;
}

export class InlinePipeline<T> extends Pipeline<T> {
    constructor(private readonly calculator: () => T) {
        super();
    }

    protected calculate(): T {
        return this.calculator();
    }
}

export class ValuePipeline<T> implements Producer<T> {
    public consumers = new LinearMap<WeakRef<Consumer>, number>();

    public valueVersion = 1;

    public checkForActuallyChangedValue(): void {
        // Do nothing. We know exactly when we have changed.
    }

    constructor(private _value: T) {}

    get value() {
        producerAccessed(this);
        return this._value as DeepReadonly<T>;
    }

    public setValue(newValue: T) {
        if (newValue !== this._value) {
            this._value = newValue;
            ++this.valueVersion;
            producerNotifyConsumers(this);
        }
    }

    public updateValue(updater: (oldValue: DeepReadonly<T>) => T) {
        this.setValue(updater(this._value as DeepReadonly<T>));
    }

    public mutateValue(mutator: (oldValue: T) => void) {
        mutator(this._value);
        ++this.valueVersion;
        producerNotifyConsumers(this);
    }
}

/**
 * When a value producer is changed, this notifies the known consumers of it that it has.
 */
function producerNotifyConsumers(producer: Producer) {
    const consumers = producer.consumers;
    for (const [consumerRef, trackingVersion] of consumers) {
        const consumer = consumerRef.deref();
        if (consumer?.trackingVersion !== trackingVersion) {
            consumers.delete(consumerRef);
            consumer?.producers.delete(producer);
        } else {
            consumer.notify(producer);
        }
    }
}

let activeConsumer: Consumer | undefined = undefined;

function producerAccessed(producer: Producer): void {
    if (activeConsumer === undefined) {
        return;
    }

    // Make a dependency between each
    producer.consumers.set(activeConsumer.ref, activeConsumer.trackingVersion);
    if (producer.consumers instanceof LinearMap && producer.consumers.size === 100) {
        producer.consumers = new Map(producer.consumers.toTuples());
    }
    activeConsumer.producers.set(producer, producer.valueVersion);
    if (activeConsumer.producers instanceof LinearMap && activeConsumer.producers.size === 100) {
        activeConsumer.producers = new Map(activeConsumer.producers.toTuples());
    }
}

function setActiveConsumer(consumer: Consumer | undefined) {
    const prevConsumer = activeConsumer;
    activeConsumer = consumer;
    return prevConsumer;
}

function consumerPollValueStatus(consumer: Consumer, notifier: Producer | boolean): boolean {
    const producers = consumer.producers;
    let skipProducer: Producer | undefined;
    if (typeof notifier !== 'boolean') {
        const valueVersion = producers.get(notifier)!;
        const atTrackingVersion = notifier.consumers.get(consumer.ref);
        if (atTrackingVersion === consumer.trackingVersion && producerPollStatus(notifier, valueVersion)) {
            return true;
        }
        if (producers.size === 1) {
            // There is only a single producer that we've now already checked, so we know for certain we
            // are not dirty.
            return false;
        }
        skipProducer = notifier;
    }
    // For a consumer, check the status of all active dependencies (producers).
    // If none of them reports a semantically new value, then the `Consumer` has not
    // observed a real dependency change (even though it may have been notified of one).

    for (const [producer, valueVersion] of producers) {
        if (producer === skipProducer) {
            continue;
        }
        const atTrackingVersion = producer.consumers.get(consumer.ref);

        if (atTrackingVersion !== consumer.trackingVersion) {
            // This dependency edge is stale, so remove it.
            producers.delete(producer);
            producer.consumers.delete(consumer.ref);
            continue;
        }

        if (producerPollStatus(producer, valueVersion)) {
            // One of the dependencies (that was used in the previous calculation) reports a real value change.
            return true;
        }
    }

    // No dependency reported a real value change, so the `Consumer` has also not been
    // impacted.
    return false;
}

/**
 * Checks if a `Producer` has a current value which is different than the value
 * last seen at a specific version by a `Consumer` which recorded a dependency on
 * this `Producer`.
 */
function producerPollStatus(producer: Producer, lastSeenValueVersion: number): boolean {
    // `producer.valueVersion` may be stale, but a mismatch still means that the value
    // last seen by the `Consumer` is also stale.
    if (producer.valueVersion !== lastSeenValueVersion) {
        return true;
    }

    // Trigger the `Producer` to update its `valueVersion` if necessary.
    producer.checkForActuallyChangedValue();

    // At this point, we can trust `producer.valueVersion`.
    return producer.valueVersion !== lastSeenValueVersion;
}

export type DeepReadonly<T> = T extends ReadonlyArray<infer R>
    ? DeepReadonlyArray<R>
    : T extends Map<infer K, infer V>
    ? DeepReadonlyMap<K, V>
    : T extends Set<infer U>
    ? DeepReadonlySet<U>
    : T extends object
    ? DeepReadonlyObject<T>
    : T;

type DeepReadonlyArray<T> = ReadonlyArray<DeepReadonly<T>>;
type DeepReadonlyMap<K, V> = ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>;
type DeepReadonlySet<U> = ReadonlySet<DeepReadonly<U>>;

type DeepReadonlyObject<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
};
