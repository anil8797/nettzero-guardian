import MurmurHash3 from 'imurmurhash';
import { BlockModel } from './block.model';
import { ICompareOptions } from '../interfaces/compare-options.interface';
import { IKeyMap } from '../interfaces/key-map.interface';

/**
 * Event Model
 */
export class EventModel {
    /**
     * Actor
     * @public
     */
    public readonly actor: any;

    /**
     * Disabled
     * @public
     */
    public readonly disabled: any;

    /**
     * Input events (name)
     * @public
     */
    public readonly input: any;

    /**
     * Output events (name)
     * @public
     */
    public readonly output: any;

    /**
     * Source block (tag)
     * @public
     */
    public readonly source: string;

    /**
     * Target block (tag)
     * @public
     */
    public readonly target: string;

    /**
     * Weight
     * @public
     */
    public get weight(): string {
        return this._weight;
    }

    /**
     * Model key
     * @public
     */
    public get key(): string {
        return null;
    }

    /**
     * Weight
     * @private
     */
    private _weight: string;

    /**
     * Source block (weight)
     * @private
     */
    private _start: string;

    /**
     * Target block (weight)
     * @private
     */
    private _end: string;

    /**
     * Weight
     * @private
     */
    private _hash: string;

    constructor(json: any) {
        this.actor = json.actor;
        this.disabled = json.disabled;
        this.input = json.input;
        this.output = json.output;
        this.source = json.source;
        this.target = json.target;
    }

    /**
     * Update all weight
     * @param map - blocks map
     * @param options - comparison options
     * @public
     */
    public update(map: IKeyMap<BlockModel>, options: ICompareOptions): void {
        const source: BlockModel = map[this.source];
        const target: BlockModel = map[this.target];
        if (source) {
            this._start = source.getWeight();
        }
        if (target) {
            this._end = target.getWeight();
        }
        const hashState = MurmurHash3();
        if (this._start) {
            hashState.hash(this._start);
        }
        if (this._end) {
            hashState.hash(this._end);
        }
        hashState.hash(this.actor);
        hashState.hash(this.disabled);
        hashState.hash(this.input);
        hashState.hash(this.output);
        const weight = String(hashState.result());
        if (options.eventLvl > 0) {
            this._weight = weight;
        } else {
            this._weight = '';
        }
        this._hash = weight;
    }

    /**
     * Convert class to object
     * @public
     */
    public toObject(): any {
        return {
            actor: this.actor,
            source: this.source,
            target: this.target,
            input: this.input,
            output: this.output,
            disabled: this.disabled,
            weight: this._weight,
            startWeight: this._start,
            endWeight: this._end,
        }
    }

    /**
     * Comparison of models using weight
     * @param item - model
     * @public
     */
    public equal(event: EventModel): boolean {
        return this._hash === event._hash;
    }
}
