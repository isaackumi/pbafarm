export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/inventory-transactions',
      permanent: false,
    },
  }
}

export default function InventoryTransactionsAliasPage() {
  return null
}
