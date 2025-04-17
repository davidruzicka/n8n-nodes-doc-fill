import {
	IBinaryData,
	IBinaryKeyData,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	IPairedItemData,
	NodeOperationError,
} from 'n8n-workflow';


import { isPDFDocument, fillForm, DocFillConfig } from './DocFillUtils';
import { PDFDocument, PDFForm } from 'pdf-lib';

const nodeOperationOptions: INodeProperties[] = [
	{
		displayName: 'Property Name',
		name: 'dataPropertyName',
		type: 'string',
		default: 'data',
		description:
			'Name of the binary property which holds the document to be used',
	},
	{
		displayName: 'Property Name Out',
		name: 'dataPropertyNameOut',
		type: 'string',
		default: 'data',
		description:
			'Name of the binary property for the output',
	},
	{
		displayName: 'Configuration JSON',
		name: 'configurationJson',
		type: 'json',
		default: '',
		description:
			'JSON used to map the keys in the PDF form to the corresponding values:'+
			'{\n'+
			'    key: string,\n'+
			'    value: string,\n'+
			'    type: "textfield" | "checkbox" | "dropdown" | "radiogroup",\n'+
			'}'+
			'Accepted values for type: "checkbox" are "true" (checked) or any other string value (unchecked)',
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

export class DocFill implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Doc Fill',
		name: 'docFill',
		group: ['transform'],
		version: 1,
		description: 'Node made for filling a pdf form.',
		defaults: {
			name: 'Doc Fill',
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

		let itemBinaryData: IBinaryKeyData;
		let dataPropertyName: string;
		let dataPropertyNameOut: string;
		let jsonString: string;
		let docFillConfigs: DocFillConfig[];
		let docBinaryData: IBinaryData;
		let docBuffer: Buffer;
		let pdfDoc: PDFDocument;
		let pdfForm: PDFForm;

		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				dataPropertyName = this.getNodeParameter('dataPropertyName', itemIndex, '') as string;
				dataPropertyNameOut = this.getNodeParameter('dataPropertyNameOut', itemIndex, '') as string;
				jsonString = this.getNodeParameter('configurationJson', itemIndex, '') as string;

			try {
				itemBinaryData = items[itemIndex].binary as IBinaryKeyData;
				docBinaryData = itemBinaryData[dataPropertyName] as IBinaryData;

				if(!isPDFDocument(docBinaryData)) {
					throw new NodeOperationError(
						this.getNode(),
						`Input (on binary property "${dataPropertyName}") should be a PDF file, was ${docBinaryData.mimeType} instead`,
						{ itemIndex },
					);
				}

				const maxPdfSizeRaw = this.getNodeParameter('maxPdfSize', itemIndex, 10);
				const maxPdfSize = (typeof maxPdfSizeRaw === 'number' ? maxPdfSizeRaw : Number(maxPdfSizeRaw) || 10) * 1024 * 1024;
				if (docBinaryData && typeof docBinaryData.size === 'number' && docBinaryData.size > maxPdfSize) {
					throw new NodeOperationError(
						this.getNode(),
						`Input (on binary property "${dataPropertyName}") exceeds maximum allowed size of ${maxPdfSize} bytes`,
						{ itemIndex },
					);
				}

				docBuffer = await this.helpers.getBinaryDataBuffer(itemIndex, dataPropertyName);
				pdfDoc = await PDFDocument.load(docBuffer);

				pdfForm = pdfDoc.getForm();

				docFillConfigs = JSON.parse(jsonString);

				docFillConfigs.forEach((el) => {
					const { success, errorMessage } = fillForm(pdfForm, el);
					if (!success) {
						throw new NodeOperationError(
							this.getNode(),
							`Error in field ${el.key}: ${errorMessage}`,
							{ itemIndex },
						);
					}
				});

				let savedDoc = await pdfDoc.save();

				const result: INodeExecutionData = {
					json: {
						...items[itemIndex].json
					},
					binary: {
						...items[itemIndex].binary,
						[dataPropertyNameOut]: await this.helpers.prepareBinaryData(
							Buffer.from(savedDoc), 
							docBinaryData.fileName ? docBinaryData.fileName : dataPropertyNameOut + '.pdf', 
							'application/pdf'
						),
					},
					pairedItem: [items[itemIndex].pairedItem as IPairedItemData],
				}

				returnData.push(result);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { ...this.getInputData(itemIndex)[0].json, error: error.message || error.toString() },
						pairedItem: [items[itemIndex].pairedItem as IPairedItemData],
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
