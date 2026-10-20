import { useStores } from "@directus/extensions-sdk";
import { humanize } from "../shared/wording.js";

/** Display names for collections and fields, as set in the Directus data model. */
export function useNames() {
  const { useCollectionsStore, useFieldsStore } = useStores();
  const collectionsStore = useCollectionsStore();
  const fieldsStore = useFieldsStore();

  const collectionName = (collection) => {
    if (String(collection).startsWith("directus_")) return humanize(collection);
    return collectionsStore.getCollection?.(collection)?.name || humanize(collection);
  };
  const fieldName = (collection, field) => (field ? fieldsStore.getField?.(collection, field)?.name || humanize(field) : "");

  const collectionIcon = (collection) => collectionsStore.getCollection?.(collection)?.icon || (String(collection).startsWith("directus_") ? "settings" : "database");

  return { collectionName, collectionIcon, fieldName };
}
