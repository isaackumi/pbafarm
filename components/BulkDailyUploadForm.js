import CsvImportForm from './CsvImportForm'

/** Daily CSV: cage_name,date,feed_amount,feed_type,feed_price,mortality,notes */
export default function BulkDailyUploadForm(props) {
  return <CsvImportForm kind="daily" {...props} />
}
