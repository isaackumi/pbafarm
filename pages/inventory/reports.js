export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/inventory/analytics',
      permanent: false,
    },
  }
}

export default function InventoryReportsPage() {
  return null
}
