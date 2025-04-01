using Entities;

namespace Interfaces
{
    public interface IEnemyConfig  : IBaseEntityConfig
    {
        public int AggressionLimit { get; }
        
        public EntitySelectionType SelectionType { get; }
    }
}
