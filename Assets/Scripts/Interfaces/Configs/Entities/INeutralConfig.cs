using Entities;

namespace Interfaces
{
    public interface INeutralConfig : IBaseEntityConfig
    {
        public EntitySelectionType SelectionType { get; }
    }
}
