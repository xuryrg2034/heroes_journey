namespace Interfaces
{
    public interface IEnemy : ISelectableEntity
    {
        public int AggressionLimit { get; }
    }
}
