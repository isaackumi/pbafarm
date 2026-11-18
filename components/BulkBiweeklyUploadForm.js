import CsvImportForm from './CsvImportForm'

/** Bi-weekly CSV: cage_name,date,batch_code,average_body_weight,total_fish_count,total_weight */
export default function BulkBiweeklyUploadForm(props) {
  return <CsvImportForm kind="biweekly" {...props} />
}
