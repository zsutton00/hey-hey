export declare const OFFLINE_DOC_SLUGS: string[];
export declare function writeOfflineDocs(options: {
  helpDirectory: string;
  outDirectory: string;
  version: string;
}): Promise<void>;
