export type SalesforceSource = {
  id: string;
  name: string;
  instanceUrl: string;
  accessToken: string;
  apiVersion: string;
  createdAt: string;
  updatedAt: string;
};

export type SalesforceObject = {
  name: string;
  label: string;
  queryable: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
};

export type ObjectField = {
  name: string;
  label: string;
  dataType: string;
  nillable: boolean;
  updateable: boolean;
  createable: boolean;
};

export type ObjectDescribe = {
  name: string;
  label: string;
  fields: ObjectField[];
};

export type QueryResult = {
  totalSize: number;
  records: Record<string, unknown>[];
};

export type SourceUpsertPayload = {
  name: string;
  instanceUrl: string;
  accessToken: string;
  apiVersion: string;
};

export type RecordMutationPayload = {
  sourceId: string;
  objectName: string;
  values: Record<string, unknown>;
};
