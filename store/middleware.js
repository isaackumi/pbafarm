export const localStorageMiddleware = store => next => action => {
  const result = next(action)
  
  // Save the entire state to localStorage after each action
  try {
    const state = store.getState()
    localStorage.setItem('reduxState', JSON.stringify(state))
  } catch (err) {
    console.error('Error saving state to localStorage:', err)
  }
  
  return result
}

export const loadState = () => {
  try {
    const serializedState = localStorage.getItem('reduxState')
    if (serializedState === null) {
      return undefined
    }
    return JSON.parse(serializedState)
  } catch (err) {
    return undefined
  }
} 