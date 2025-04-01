using Entities;

namespace Interfaces
{
    public interface ISelectableEntity : IBaseEntity
    {
        public EntitySelectionType SelectionType { get; }
    }
}
