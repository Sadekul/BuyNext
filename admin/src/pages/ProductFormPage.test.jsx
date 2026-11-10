import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

const CATEGORIES = [{ slug: 'beauty', name: 'Beauty' }]

async function openNewProduct(routes) {
  withSession()
  const fetchMock = mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/categories': { body: CATEGORIES }, ...routes })
  renderApp('/products/new')
  await screen.findByRole('heading', { name: 'Add product' })
  return fetchMock
}

describe('add product form', () => {
  it('checks the fields before sending anything', async () => {
    const fetchMock = await openNewProduct({})
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    expect(await screen.findByText('Enter a name of 2 to 120 characters.')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Choose a category.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it("shows the server's validation messages on the fields (422)", async () => {
    await openNewProduct({
      'POST /api/admin/products': { status: 422, body: { message: 'Check', errors: { title: ['That name is already taken.'] } } },
    })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Lamp')
    await user.selectOptions(screen.getByLabelText('Category'), 'beauty')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    expect(await screen.findByText('That name is already taken.')).toBeInTheDocument()
  })

  it('says clearly that a created product is a demo and not saved', async () => {
    await openNewProduct({ 'POST /api/admin/products': { status: 201, body: { product: { id: 195, title: 'Lamp' }, simulated: true } } })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Lamp')
    await user.selectOptions(screen.getByLabelText('Category'), 'beauty')
    await user.clear(screen.getByLabelText('Price (USD)'))
    await user.type(screen.getByLabelText('Price (USD)'), '19.99')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Product created \(demo, id #195\).*doesn't store changes/)
  })
})
