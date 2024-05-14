import {getRandomInteger} from './util';
import {GRAPH} from './graph';
import {Pipeline, ValuePipeline} from './pipeline';

const MOD_FACTOR = 2;
interface Pipe<G> {
    get value(): G;
}

let calculationsCount = 0;

const DEBUG = process.execArgv.includes('--inspect-brk');

(async function () {
    // Rebind the subject for the benchmark.
    const Pipe = Pipeline;
    const ValuePipe = ValuePipeline;

    class MiddlePipe extends Pipe<number> {
        constructor(private readonly deps: Pipe<number>[]) {
            super();
        }

        protected calculate(): number {
            calculationsCount++;
            let sum = 0;
            for (let i = 0; i < this.deps.length; i++) {
                sum += this.deps[i].value;
            }
            return sum % MOD_FACTOR;
        }

        /** the pipeline.ts implementation doesn't accept equality checkers yet */
        // protected override areEqual(a: number, b: number) {
        //     return a === b;
        // }
    }

    //------------------------------------------------------------------------------

    global.gc();
    const initialHeapUsed = process.memoryUsage().heapUsed;
    const setupStartTime = Date.now();

    const valuePipes: ValuePipeline<number>[] = [];
    const allPipes = new Map<string, Pipe<number>>();
    let outputPipe: Pipe<number>;
    // debugger;
    GRAPH.forEach((row) => {
        const [pipeId, ...depsId] = row;
        if (allPipes.has(pipeId)) {
            console.log(pipeId);
        }
        const deps = depsId.map((d) => allPipes.get(d)!);
        if (deps.length == 0) {
            const pipe = new ValuePipe(getRandomInteger(MOD_FACTOR));
            valuePipes.push(pipe);
            allPipes.set(pipeId, pipe);
        } else {
            const pipe = new MiddlePipe(deps);
            allPipes.set(pipeId, pipe);
            outputPipe = pipe;
        }
    });
    console.log(allPipes.size);
    console.log(GRAPH.length);
    console.log(`Declared the pipe graph in ${Date.now() - setupStartTime}ms`);
    global.gc();
    // debugger;
    // Get the value once to measure creating all the initial pipe dependencies
    outputPipe.value;
    console.log(`Setup the pipe graph in ${Date.now() - setupStartTime}ms`);
    allPipes.clear();
    await Promise.resolve();
    global.gc();
    await new Promise((resolve) => setTimeout(resolve));
    global.gc();
    console.log(`Heap Used: <${Math.round((process.memoryUsage().heapUsed - initialHeapUsed) / 1024 / 1024)}MB`);

    process.stdout.write(`These should be deterministic: `);

    if (DEBUG) {
        debugger;
    }

    const start = performance.now();
    const LOOPS = 2560;
    // console.profile('mainLoop');
    for (let i = 0; i < LOOPS; i++) {
        const r = outputPipe.value;
        if (i % Math.floor(LOOPS / 10) == 0) {
            process.stdout.write(`${r}..`);
        }

        const valuePipe = valuePipes[getRandomInteger(valuePipes.length)];
        valuePipe.setValue((valuePipe.value + 1) % MOD_FACTOR);
    }
    console.log(`${outputPipe.value}`);
    console.log(`Done in ${performance.now() - start}ms`);
    // console.profileEnd('mainLoop');
    console.log(`Calculated a MiddlePipe ${calculationsCount} times`);
    debugger;

    global.gc();
    await new Promise((resolve) => setTimeout(resolve));
    global.gc();
    console.log(`Final Heap Used: <${Math.round((process.memoryUsage().heapUsed - initialHeapUsed) / 1024 / 1024)}MB`);

    outputPipe = undefined;
    valuePipes.length = 0;

    global.gc();
    await new Promise((resolve) => setTimeout(resolve));
    global.gc();
    console.log(`Leaked: <${Math.round((process.memoryUsage().heapUsed - initialHeapUsed) / 1024 / 1024)}MB`);

    if (DEBUG) {
        debugger;
        console.log('(Press Ctrl+C to exit.)');
    }
})();
