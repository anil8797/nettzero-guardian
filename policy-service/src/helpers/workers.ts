import { Singleton } from '@helpers/decorators/singleton';
import { GenerateUUIDv4, IActiveTask, ITask, WorkerEvents } from '@guardian/interfaces';
import { ServiceRequestsBase } from '@helpers/service-requests-base';
import { Environment } from '@hedera-modules';

/**
 * Workers helper
 */
@Singleton
export class Workers extends ServiceRequestsBase {
    /**
     * Tasks sended to work
     * @private
     */
    private readonly tasksCallbacks: Map<string, IActiveTask> = new Map();

    /**
     * Target
     */
    public target: string = 'guardians';

    /**
     * Max Repetitions
     * @private
     */
    private readonly maxRepetitions = 25;

    /**
     * Add non retryable task
     * @param task
     * @param priority
     */
    public addNonRetryableTask(task: ITask, priority: number): Promise<any> {
        if (!task.data.network) {
            task.data.network = Environment.network;
        }
        return this.addTask(task, priority, false);
    }

    /**
     * Add retryable task
     * @param task
     * @param priority
     * @param attempts
     */
    public addRetryableTask(task: ITask, priority: number, attempts: number = 0): Promise<any> {
        if (!task.data.network) {
            task.data.network = Environment.network;
        }
        return this.addTask(task, priority, true, attempts);
    }

    /**
     * Add retryable task
     * @param task
     * @param priority
     * @param isRetryableTask
     * @param attempts
     */
    private addTask(task: ITask, priority: number, isRetryableTask: boolean = false, attempts: number = 0): Promise<any> {
        const taskId = GenerateUUIDv4()
        task.id = taskId;
        task.priority = priority;
        attempts = attempts > 0 && attempts < this.maxRepetitions ? attempts : this.maxRepetitions;
        // this.queue.push(task);
        const result = new Promise((resolve, reject) => {
            this.tasksCallbacks.set(taskId, {
                task,
                number: 0,
                callback: (data, error) => {
                    if (error) {
                        console.log(error);
                        // if (isRetryableTask) {
                        //     if (this.tasksCallbacks.has(taskId)) {
                        //         const callback = this.tasksCallbacks.get(taskId);
                        //         callback.number++;
                        //         if (callback.number > attempts) {
                        //             this.tasksCallbacks.delete(taskId);
                        //             reject(error);
                        //             return;
                        //         }
                        //     }
                        //     this.queue.push(task);
                        // } else {
                        //     reject(error);
                        // }
                    } else {
                        this.tasksCallbacks.delete(taskId);
                        resolve(data);
                    }
                }
            });
        });
        this.request(WorkerEvents.PUSH_TASK, {task, priority, isRetryableTask, attempts});
        return result;
    }

    /**
     * Init listeners
     */
    public initListeners() {
        this.channel.subscribe(WorkerEvents.TASK_COMPLETE_BROADCAST, async (msg: any) => {
            const activeTask = this.tasksCallbacks.get(msg.id);
            activeTask?.callback(msg.data, msg.error);
            // return new MessageResponse(null);
        });
    }
}
