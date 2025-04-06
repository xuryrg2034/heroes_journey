using Entities;
using Services;

namespace Interfaces
{
    public interface IEnemyConfig  : IBaseEntityConfig
    {
        public int AggressionLimit { get; }
        
        public EntitySelectionType SelectionType { get; }
        
        public EnemyRank Rank { get; }
    }
}
