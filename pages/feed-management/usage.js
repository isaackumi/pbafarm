export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/feed-issue',
      permanent: false,
    },
  }
}

export default function FeedManagementUsagePage() {
  return null
}
