public interface IDamageable
{
    public int Health { get; }
    public bool CanBeDamageable { get; }
    public void TakeDamage(int damage) { }
}