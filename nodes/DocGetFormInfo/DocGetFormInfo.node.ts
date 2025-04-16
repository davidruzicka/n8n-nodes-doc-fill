import {
	IBinaryData,
	IBinaryKeyData,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { PDFDocument } from 'pdf-lib';

const nodeOperationOptions: INodeProperties[] = [
	{
		displayName: 'Property Name',
		name: 'dataPropertyName',
		type: 'string',
		default: 'data',
		description:
			'Name of the binary property which holds the PDF document to analyze',
	},
	{
		displayName: 'Max PDF Size',
		name: 'maxPdfSize',
		type: 'number',
		default: 10,
		description:
			'Maximum size of the PDF file in MB',
	},
];

export class DocGetFormInfo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Doc Get Form Info',
		name: 'docGetFormInfo',
		group: ['transform'],
		version: 1,
		description: 'Gets form field information from a PDF document.',
		defaults: {
			name: 'Doc Get Form Info',
		},
		inputs: ['main'],
		inputNames: ['Document'],
		outputs: ['main'],
		properties: [
			...nodeOperationOptions
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const dataPropertyName = this.getNodeParameter('dataPropertyName', itemIndex, '') as string;
				const itemBinaryData = items[itemIndex].binary as IBinaryKeyData;
				const docBinaryData = itemBinaryData[dataPropertyName] as IBinaryData;

				if (!docBinaryData) {
					throw new NodeOperationError(
						this.getNode(),
						`No binary data found on property "${dataPropertyName}"`,
						{ itemIndex },
					);
				}

				if (docBinaryData.mimeType !== 'application/pdf') {
					throw new NodeOperationError(
						this.getNode(),
						`Input (on binary property "${dataPropertyName}") should be a PDF file, was ${docBinaryData.mimeType} instead`,
						{ itemIndex },
					);
				}

				const maxPdfSize = this.getNodeParameter('maxPdfSize', itemIndex, 10) * 1024 * 1024;
				if (docBinaryData.size > maxPdfSize) {
					throw new NodeOperationError(
						this.getNode(),
						`Input (on binary property "${dataPropertyName}") exceeds maximum allowed size of ${maxPdfSize} bytes`,
						{ itemIndex },
					);
				}

				const docBuffer = await this.helpers.getBinaryDataBuffer(itemIndex, dataPropertyName);
				const pdfDoc = await PDFDocument.load(docBuffer);
				const form = pdfDoc.getForm();
				const fields = form.getFields();

				const formFields = fields.map(field => ({
					name: field.getName(),
					type: field.constructor.name.replace('PDF', '').toLowerCase(),
				}));

				const result: INodeExecutionData = {
					json: {
						totalFields: fields.length,
						fields: formFields,
					},
					pairedItem: { item: itemIndex },
				};

				returnData.push(result);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
						},
						pairedItem: { item: itemIndex },
					});
				} else {
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, {
						itemIndex,
					});
				}
			}
		}

		return this.prepareOutputData(returnData);
	}
}
