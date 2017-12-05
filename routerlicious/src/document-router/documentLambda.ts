import { Provider } from "nconf";
import * as core from "../core";
import { IContext, IPartitionLambda, IPartitionLambdaFactory } from "../kafka-service/lambdas";
import * as utils from "../utils";
import { DocumentContextManager } from "./contextManager";
import { DocumentContext } from "./documentContext";
import { DocumentPartition } from "./documentPartition";

export class DocumentLambda implements IPartitionLambda {
    private documents = new Map<string, DocumentPartition>();
    private contextManager: DocumentContextManager;

    constructor(private factory: IPartitionLambdaFactory, private config: Provider, context: IContext) {
        this.contextManager = new DocumentContextManager(context);
    }

    // THOUGHT - does this maybe not even want to return a promise? It's just sync and we maintain a max outstanding
    // message count? Maybe put in async just to do flow control, etc... or rely on inbound calls to keep things sync?
    //
    // Need to understand what retry logic looks like

    public async handler(message: utils.kafkaConsumer.IMessage): Promise<any> {
        await this.handlerCore(message);
        this.contextManager.setMaxOffset(message.offset);
    }

    public async handlerCore(kafkaMessage: utils.kafkaConsumer.IMessage): Promise<any> {
        const message = JSON.parse(kafkaMessage.value) as core.IMessage;
        if (message.type !== core.SequencedOperationType) {
            return;
        }

        const sequencedMessage = message as core.ISequencedOperationMessage;
        if (!this.documents.has(sequencedMessage.documentId)) {
            const documentContext = new DocumentContext();
            const document = new DocumentPartition(
                this.factory,
                this.config,
                sequencedMessage.documentId,
                documentContext);
            this.documents.set(sequencedMessage.documentId, document);
        }

        // Forward the message to the document queue and then resolve the promise to begin processing more messages
        const document = this.documents.get(sequencedMessage.documentId);
        document.context.setMaxOffset(kafkaMessage.offset);
        document.process(kafkaMessage);
    }
}
